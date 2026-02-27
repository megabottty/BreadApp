import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../services/toast.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toastService = inject(ToastService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      let errorMessage = 'An unexpected error occurred';

      if (error.error instanceof ErrorEvent) {
        // Client-side error
        errorMessage = `Error: ${error.error.message}`;
      } else {
        // Server-side error
        switch (error.status) {
          case 0:
            errorMessage = 'Unable to connect to server. Please check your connection.';
            break;
          case 400:
            errorMessage = error.error?.error || error.error?.message || 'Invalid request';
            break;
          case 401:
            errorMessage = 'Please log in to continue';
            break;
          case 403:
            errorMessage = 'You don\'t have permission to perform this action';
            break;
          case 404:
            errorMessage = error.error?.error || 'Resource not found';
            break;
          case 409:
            errorMessage = error.error?.error || 'A conflict occurred';
            break;
          case 422:
            errorMessage = error.error?.error || 'Validation failed';
            break;
          case 500:
            errorMessage = 'Server error. Please try again later.';
            break;
          case 503:
            errorMessage = 'Service temporarily unavailable';
            break;
          default:
            if (error.error?.error) {
              errorMessage = error.error.error;
            } else if (error.error?.message) {
              errorMessage = error.error.message;
            } else {
              errorMessage = `Error ${error.status}: ${error.statusText}`;
            }
        }
      }

      // Show toast notification for errors
      console.error('HTTP Error:', error);
      toastService.error(errorMessage);

      return throwError(() => error);
    })
  );
};
