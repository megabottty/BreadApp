/**
 * Server-side pricing for storefront checkout. The browser only says WHAT the
 * customer wants ({ recipeId, packOptionId, quantity, addons, isSubscription });
 * every price, discount and total is worked out here from the bakery's own
 * recipe rows, so what Stripe charges (or what a pay-at-pickup order records)
 * can't be changed from the browser.
 *
 * The pure functions (priceLines, computeDiscount, checkPickupDate, ...) take
 * plain data and are unit-tested in checkout-pricing.spec.cjs.
 */
const crypto = require('crypto');
const { todayInDenver, addDays, weekdayOf } = require('./subscriptions.cjs');

const MAX_QTY_PER_LINE = 50;
const MAX_LINES = 30;
const LEAD_DAYS = 2;
const LOYALTY_DISCOUNT = 8;
const LOYALTY_ORDER_THRESHOLD = 10;

class CheckoutError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const roundMoney = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Add-ons a customer may pick for a recipe. Mirrors
 * product-customization-modal.ts getAddOns(): the recipe's own add-ons, else
 * the category/name defaults, and never slicing/crusty options on monkey bread.
 */
const resolveAddons = (recipe) => {
  const name = String(recipe.name || '').toLowerCase();
  const isMonkeyBread = name.includes('monkey');
  const isRoll = /\brolls?\b/.test(name);
  const isBread = recipe.category === 'BREAD' || name.includes('bread') || name.includes('loaf');

  let addons = [];
  if (Array.isArray(recipe.available_addons) && recipe.available_addons.length > 0) {
    addons = recipe.available_addons
      .filter(a => a && typeof a.name === 'string')
      .map(a => ({ name: a.name, price: Number(a.price) || 0 }));
  } else if (isBread && !isRoll) {
    addons = [{ name: 'Sliced', price: 2.0 }, { name: 'Double Baked (Extra Crusty)', price: 1.0 }];
  } else if (isRoll) {
    addons = [{ name: 'Extra Frosting', price: 1.5 }, { name: 'Warm it up', price: 0 }];
  }
  if (isMonkeyBread) {
    addons = addons.filter(a => !/slice|baked|crunchy|crusty/.test(a.name.toLowerCase()));
  }
  return addons;
};

/** Finished weight of one item: item_weight_grams, else the batch ingredient sum (same as cart.service). */
const unitWeightOf = (recipe) => {
  if (Number(recipe.item_weight_grams) > 0) return Number(recipe.item_weight_grams);
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  return ingredients.reduce((sum, ing) => sum + (Number(ing?.weight) || 0), 0);
};

/**
 * Price the requested lines against recipe rows (keyed by id).
 * Returns { lines, subtotal, hasSubscription }. Each priced line:
 *   { recipeId, name, packLabel, packSize, packCount, unitPrice, addons,
 *     lineTotal, isSubscription, quantity (= items baked), weightGrams }
 * `quantity` stays "number of items" because the baker's prep views use it.
 */
const priceLines = (requested, recipesById) => {
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new CheckoutError('Your bag is empty.');
  }
  if (requested.length > MAX_LINES) throw new CheckoutError('That\'s a lot of bread! Please call us for an order this big.');

  const lines = requested.map((raw) => {
    const recipe = recipesById.get(String(raw?.recipeId || ''));
    if (!recipe || recipe.is_hidden) {
      throw new CheckoutError('Something in your bag is no longer available. Please remove it and try again.');
    }
    const packCount = Number(raw.quantity);
    if (!Number.isInteger(packCount) || packCount < 1 || packCount > MAX_QTY_PER_LINE) {
      throw new CheckoutError(`Please choose between 1 and ${MAX_QTY_PER_LINE} of ${recipe.name}.`);
    }

    const packs = Array.isArray(recipe.pack_options) ? recipe.pack_options : [];
    let pack = null;
    if (packs.length > 0) {
      pack = packs.find(p => p.id === raw.packOptionId) || packs[0];
    }
    const basePrice = pack ? Number(pack.price) : Number(recipe.price);
    if (!(basePrice >= 0)) throw new CheckoutError(`${recipe.name} doesn't have a price yet.`, 500);
    const packSize = pack ? Number(pack.size) || 1 : 1;

    const allowedAddons = resolveAddons(recipe);
    const requestedAddons = Array.isArray(raw.addons) ? raw.addons.map(String) : [];
    const addons = requestedAddons
      .map(name => allowedAddons.find(a => a.name === name))
      .filter(Boolean);
    const addonsPrice = addons.reduce((sum, a) => sum + a.price, 0);

    const unitPrice = roundMoney(basePrice + addonsPrice);
    const quantity = packCount * packSize;
    const addonText = addons.length ? ` + ${addons.map(a => a.name).join(', ')}` : '';
    return {
      recipeId: recipe.id,
      name: `${recipe.name}${pack ? ` (${pack.label})` : ''}${addonText}`,
      packLabel: pack ? pack.label : null,
      packSize,
      packCount,
      unitPrice,
      addons,
      lineTotal: roundMoney(unitPrice * packCount),
      isSubscription: !!raw.isSubscription,
      quantity,
      weightGrams: Math.round(unitWeightOf(recipe) * quantity)
    };
  });

  const subtotal = roundMoney(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  return { lines, subtotal, hasSubscription: lines.some(l => l.isSubscription) };
};

/**
 * Discount in dollars for a priced bag. promo is a bakery_promos row or null;
 * loyaltyEligible comes from countQualifyingOrders. Never more than the subtotal.
 */
const computeDiscount = ({ promo, lines, subtotal, loyaltyEligible }) => {
  let promoDiscount = 0;
  if (promo && promo.is_active !== false) {
    const value = Number(promo.value) || 0;
    if (promo.type === 'FIXED') promoDiscount = value;
    else if (promo.type === 'PERCENT') promoDiscount = subtotal * Math.min(Math.max(value, 0), 100) / 100;
    else if (promo.type === 'FREE_LOAF' && lines.length > 0) {
      // One free item: the cheapest single item in the bag.
      promoDiscount = Math.min(...lines.map(l => l.unitPrice / (l.packSize || 1)));
    }
  }
  const loyaltyDiscount = loyaltyEligible ? LOYALTY_DISCOUNT : 0;
  const total = Math.min(subtotal, roundMoney(promoDiscount + loyaltyDiscount));
  return {
    promoDiscount: roundMoney(Math.min(promoDiscount, subtotal)),
    loyaltyDiscount: roundMoney(Math.min(loyaltyDiscount, subtotal - Math.min(promoDiscount, subtotal))),
    discount: roundMoney(Math.max(0, total))
  };
};

/**
 * Pickup date rules, in the bakery's timezone: at least LEAD_DAYS days out, and
 * Monday/Tuesday when the bag has a weekly subscription. Returns an error
 * message or null.
 */
const checkPickupDate = (dateStr, { hasSubscription, today = todayInDenver() } = {}) => {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return 'Please choose a pickup day.';
  if (dateStr < addDays(today, LEAD_DAYS)) return 'Pickup must be at least 48 hours from now. Please choose a later day.';
  if (dateStr > addDays(today, 120)) return 'Please choose a pickup day within the next few months.';
  if (hasSubscription) {
    const wd = weekdayOf(dateStr);
    if (wd !== 1 && wd !== 2) return 'Weekly subscriptions are picked up on a Monday or Tuesday.';
  }
  return null;
};

/**
 * Order IDs: "DD-" + 10 base32 characters. When the browser sends a
 * checkout attempt key, the ID is derived from it, so a double-tapped
 * "Place order" maps to the same order (the unique order_id blocks the copy).
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const toCode = (bytes, length) => Array.from(bytes.subarray(0, length), b => ALPHABET[b % ALPHABET.length]).join('');
const newOrderId = (attemptKey) => {
  if (typeof attemptKey === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(attemptKey)) {
    const digest = crypto.createHmac('sha256', process.env.ORDER_ID_SALT || 'daily-dough-order-ids').update(attemptKey).digest();
    return `DD-${toCode(digest, 10)}`;
  }
  return `DD-${toCode(crypto.randomBytes(10), 10)}`;
};

const MAX_TEXT = { name: 80, phone: 30, email: 254, notes: 450 };
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates and trims the customer's contact details. Throws CheckoutError. */
const cleanCustomer = (input, { normalizePhone }) => {
  const c = input || {};
  const customer = {
    name: clean(c.name, MAX_TEXT.name),
    phone: clean(c.phone, MAX_TEXT.phone),
    email: clean(c.email, MAX_TEXT.email).toLowerCase(),
    notes: clean(c.notes, MAX_TEXT.notes),
    notificationPreference: ['SMS', 'EMAIL', 'BOTH'].includes(c.notificationPreference) ? c.notificationPreference : 'EMAIL'
  };
  if (!customer.name) throw new CheckoutError('Please add your name.');
  const wantsSms = customer.notificationPreference !== 'EMAIL';
  const wantsEmail = customer.notificationPreference !== 'SMS';
  if (customer.email && !EMAIL_RE.test(customer.email)) throw new CheckoutError('That email address doesn\'t look right.');
  if (wantsEmail && !customer.email) throw new CheckoutError('Please add your email address for order updates.');
  if (customer.phone && !normalizePhone(customer.phone)) throw new CheckoutError('That phone number doesn\'t look right. Use 10 digits, e.g. 801-555-0123.');
  if (wantsSms && !customer.phone) throw new CheckoutError('Please add your phone number for texts.');
  return customer;
};

// ---------------------------------------------------------------------------
// Database lookups
// ---------------------------------------------------------------------------

const loadRecipes = async (supabase, tenantId, requested) => {
  const ids = [...new Set((requested || []).map(l => String(l?.recipeId || '')).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('bakery_recipes')
    .select('id, name, category, price, pack_options, available_addons, is_hidden, item_weight_grams, ingredients')
    .eq('tenant_id', tenantId)
    .in('id', ids);
  if (error) throw new CheckoutError('We couldn\'t load the menu just now. Please try again.', 503);
  return new Map((data || []).map(r => [String(r.id), r]));
};

const loadPromo = async (supabase, tenantId, code) => {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return null;
  const { data } = await supabase
    .from('bakery_promos')
    .select('id, code, type, value, description, is_active')
    .eq('tenant_id', tenantId)
    .eq('code', normalized)
    .maybeSingle();
  return data && data.is_active !== false ? data : null;
};

/** Loyalty: a signed-in customer with LOYALTY_ORDER_THRESHOLD+ completed or paid orders gets $8 off. */
const isLoyaltyEligible = async (supabase, tenantId, customerId) => {
  if (!customerId) return false;
  const { count, error } = await supabase
    .from('bakery_orders')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .neq('status', 'CANCELLED')
    .or('payment_status.eq.PAID,status.eq.COMPLETED');
  if (error) return false;
  return (count || 0) >= LOYALTY_ORDER_THRESHOLD;
};

/**
 * Everything the two checkout routes need, in one call.
 * body: { lines, promoCode, pickupDate, customer, attemptKey }
 * customerId: the verified signed-in user id, or null for guests.
 */
const quoteCheckout = async (supabase, tenantId, body, { customerId, normalizePhone, today, priceOnly = false } = {}) => {
  const recipes = await loadRecipes(supabase, tenantId, body.lines);
  const priced = priceLines(body.lines, recipes);
  let customer = null;
  if (!priceOnly) {
    const dateProblem = checkPickupDate(body.pickupDate, { hasSubscription: priced.hasSubscription, today });
    if (dateProblem) throw new CheckoutError(dateProblem);
    if (priced.hasSubscription && !customerId) {
      throw new CheckoutError('Subscriptions need an account. Please log in or create one, then try again.', 401);
    }
    customer = cleanCustomer(body.customer, { normalizePhone });
  }

  const promo = await loadPromo(supabase, tenantId, body.promoCode);
  if (body.promoCode && !promo) throw new CheckoutError('That promo code isn\'t valid any more. Remove it and try again.');
  // The $8 "Bread Addict" reward is paused until its rules are settled
  // (once per 10 orders? every order after 10?). Turn on with LOYALTY_REWARD_ENABLED=true.
  const loyaltyEligible = process.env.LOYALTY_REWARD_ENABLED === 'true'
    && await isLoyaltyEligible(supabase, tenantId, customerId);
  const discount = computeDiscount({ promo, lines: priced.lines, subtotal: priced.subtotal, loyaltyEligible });

  return {
    ...priced,
    promo,
    ...discount,
    total: roundMoney(priced.subtotal - discount.discount),
    pickupDate: body.pickupDate,
    customer,
    orderId: newOrderId(body.attemptKey)
  };
};

module.exports = {
  CheckoutError,
  resolveAddons,
  priceLines,
  computeDiscount,
  checkPickupDate,
  cleanCustomer,
  newOrderId,
  loadPromo,
  isLoyaltyEligible,
  quoteCheckout,
  roundMoney,
  LOYALTY_DISCOUNT
};
