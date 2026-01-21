import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalService } from '../../services/modal.service';

@Component({
  selector: 'app-notification-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (modalService.activeModal(); as modal) {
      <div class="modal-overlay" (click)="close()">
        <div class="modal-content card" [attr.data-type]="modal.type" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h2>{{modal.title}}</h2>
            <button class="btn-close" (click)="close()">×</button>
          </div>
          <div class="modal-body">
            <p>{{modal.message}}</p>
          </div>
          <div class="modal-footer">
            @if (modal.type === 'confirm') {
              <button class="btn-outline" (click)="cancel(modal)">Cancel</button>
              <button class="btn-primary" (click)="confirm(modal)">Yes, Restore</button>
            } @else {
              <button class="btn-primary" (click)="close()">Got it</button>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      padding: 1rem;
    }

    .modal-content {
      width: 100%;
      max-width: 450px;
      padding: 0 !important;
      overflow: hidden;
      animation: modalPop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      border: 1px solid var(--border-color);
      border-left: 8px solid var(--accent-sage);
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1);
    }

    .modal-content[data-type="success"] { border-left-color: #7D8F69; }
    .modal-content[data-type="warning"] { border-left-color: #E9B384; }
    .modal-content[data-type="error"] { border-left-color: var(--accent-terracotta); }
    .modal-content[data-type="info"] { border-left-color: var(--accent-sage); }
    .modal-content[data-type="confirm"] { border-left-color: var(--accent-sage); }

    .modal-header {
      padding: 1.5rem 2rem;
      background: var(--bg-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-color);
    }

    .modal-header h2 {
      margin: 0;
      font-size: 1.25rem;
      color: var(--text-primary);
      font-family: 'Serif', Georgia, serif;
    }

    .btn-close {
      background: var(--btn-secondary);
      border: none;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      cursor: pointer;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
      transition: all 0.2s;
    }

    .btn-close:hover {
      background: var(--border-color);
      color: var(--text-primary);
    }

    .modal-body {
      padding: 2rem;
      background: var(--card-bg);
    }

    .modal-body p {
      margin: 0;
      line-height: 1.6;
      color: var(--text-primary);
      font-size: 1.05rem;
    }

    .modal-footer {
      padding: 1rem 2rem 1.5rem;
      background: var(--card-bg);
      display: flex;
      justify-content: flex-end;
      gap: 1rem;
    }

    .btn-primary {
      background: var(--accent-sage);
      color: white;
      border: none;
      padding: 0.75rem 2rem;
      border-radius: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-primary:hover {
      background: var(--accent-sage-dark);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px var(--shadow-color);
    }

    .btn-outline {
      background: transparent;
      color: var(--text-secondary);
      border: 1px solid var(--border-color);
      padding: 0.75rem 1.5rem;
      border-radius: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-outline:hover {
      background: var(--bg-color);
      color: var(--text-primary);
      border-color: var(--text-secondary);
    }

    @keyframes modalPop {
      from { transform: scale(0.9); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
  `]
})
export class NotificationModalComponent {
  modalService = inject(ModalService);

  close() {
    this.modalService.close();
  }

  confirm(modal: any) {
    if (modal.onConfirm) modal.onConfirm();
    this.close();
  }

  cancel(modal: any) {
    if (modal.onCancel) modal.onCancel();
    this.close();
  }
}
