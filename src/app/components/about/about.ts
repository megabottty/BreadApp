import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

interface AboutValue {
  icon: string;
  title: string;
  text: string;
}

interface AboutPhoto {
  url: string;
  alt: string;
}

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './about.html',
  styleUrls: ['./about.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AboutComponent {
  readonly ownerName = 'Megan';
  readonly heroTitle = `Hi, I'm ${this.ownerName}`;
  readonly heroSubtitle = 'A home bakery in Salt Lake City';

  readonly bioTitle = 'How this started';
  readonly bioText = `I started baking in 2024 for the simplest reason: I love really good food, and I wanted to make food that was beautiful too, closer to art than to a chore. One loaf turned into a few, a few turned into neighbors asking when the next bake was, and now The Daily Dough runs right out of my own kitchen.`;

  readonly morningsText = `My favorite part of the week is the early morning. I wake up while the sky is still dark and the world hasn't stirred yet, turn the ovens on, and start shaping. There's a calm in waiting for a slow rise, and a little bit of art in scoring each loaf by hand right before it goes in. By the time the sun is up, the house smells like bread.`;

  readonly starterText = `Every loaf here is raised by a sourdough starter that is 32 years old. It's older than this bakery by a few decades, it gets fed and looked after every single day, and it's what gives the bread its depth, its tang, and that open, custardy crumb. No commercial yeast, ever. Just flour, water, salt, time, and a very old friend in a jar.`;

  readonly whyIDoIt = `Baking lets me give something back to the people around me. Meeting my patrons at pickup, hearing what you did with last week's loaf, watching a kid reach for the crust first: it fills my heart. I honestly think baking for the people you love should be its own love language, and I'm lucky that I get to speak it for a living.`;

  readonly values: readonly AboutValue[] = [
    { icon: '🏡', title: 'Made at home', text: 'Small batches from my own kitchen, never a factory line. If I wouldn\'t serve it at my table, it doesn\'t go in your bag.' },
    { icon: '⏳', title: 'Slow and patient', text: 'A 24-hour cold ferment and a 32-year-old starter do the work. Good bread can\'t be rushed, and I don\'t try.' },
    { icon: '🎨', title: 'Food as art', text: 'Every loaf is shaped and scored by hand. I want it to be as beautiful on your counter as it is delicious.' },
    { icon: '🤝', title: 'Community', text: 'Bread is meant to be shared. I love meeting the people who eat it, and this neighborhood is why I bake.' }
  ];

  readonly findMeText = `I bake from my home in Salt Lake City. Orders are picked up on Mondays and Tuesdays, and the exact address is in your order confirmation. Come say hi, ask me anything about sourdough, and tell me what you're baking too.`;

  readonly photos: readonly AboutPhoto[] = [
    { url: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=800', alt: 'A fresh loaf, just out of the oven' },
    { url: 'https://images.unsplash.com/photo-1585478259715-876a6a81fc08?q=80&w=800', alt: 'Shaping dough before the morning bake' },
    { url: 'https://images.unsplash.com/photo-1549931319-a545dcf3bc73?q=80&w=800', alt: 'Scored and ready for the oven' }
  ];
}
