import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-splash-screen',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './splash-screen.html',
  styleUrls: ['./splash-screen.css']
})
export class SplashScreenComponent implements OnInit {
  isVisible = signal(true);
  message = signal('Preheating the oven...');

  private messages = [
    'Feeding the starter...',
    'Kneading the dough...',
    'Waiting for the first rise...',
    'Dusting with flour...',
    'Scoring the loaves...'
  ];

  ngOnInit() {
    let count = 0;
    const interval = setInterval(() => {
      if (count < this.messages.length) {
        this.message.set(this.messages[count]);
        count++;
      } else {
        clearInterval(interval);
        setTimeout(() => this.isVisible.set(false), 500);
      }
    }, 600);
  }
}
