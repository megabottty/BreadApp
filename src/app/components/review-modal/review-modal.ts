import { Component, EventEmitter, Input, Output, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalculatedRecipe, Review } from '../../logic/bakers-math';
import { AuthService } from '../../services/auth.service';
import { ReviewService } from '../../services/review.service';

@Component({
  selector: 'app-review-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './review-modal.html',
  styleUrls: ['./review-modal.css']
})
export class ReviewModalComponent {
  @Input({ required: true }) product!: CalculatedRecipe;
  @Output() close = new EventEmitter<void>();

  private authService = inject(AuthService);
  private reviewService = inject(ReviewService);

  rating = signal(5);
  comment = signal('');

  setRating(val: number) {
    this.rating.set(val);
  }

  submitReview() {
    const user = this.authService.user();
    if (!user) return;

    const review: Review = {
      id: Math.random().toString(36).substring(7).toUpperCase(),
      recipeId: this.product.id || '',
      customerId: user.id,
      customerName: user.name,
      rating: this.rating(),
      comment: this.comment(),
      date: new Date().toISOString()
    };

    this.reviewService.addReview(review);
    this.close.emit();
  }
}
