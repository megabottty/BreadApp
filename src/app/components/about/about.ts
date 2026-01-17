import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './about.html',
  styleUrls: ['./about.css']
})
export class AboutComponent {
  // Bio data can be moved here for better management
  ownerName = 'Megan';
  bioTitle = 'Passionate Baker & Flour Enthusiast';
  bioText = `Hi, I'm ${this.ownerName}. My journey with bread started in my own kitchen, driven by a simple desire for a better loaf. What began as an experiment with sourdough quickly turned into an obsession with hydration, fermentation, and the magic of three simple ingredients: flour, water, and salt.`;
  whyIDoIt = `I believe that bread is more than just food; it's a craft that connects us to our roots. I do this because I love the process—the slow rise, the crackle of the crust, and the joy of sharing a fresh loaf with others. Every bread I bake is a piece of my heart, crafted with patience and care.`;

  photos = [
    { url: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=800', alt: 'Freshly baked sourdough' },
    { url: 'https://images.unsplash.com/photo-1585478259715-876a6a81fc08?q=80&w=800', alt: 'Baker at work' },
    { url: 'https://images.unsplash.com/photo-1549931319-a545dcf3bc73?q=80&w=800', alt: 'Rustic loaves' }
  ];
}
