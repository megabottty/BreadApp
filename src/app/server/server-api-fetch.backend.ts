import { Injectable } from '@angular/core';
import { FetchBackend, HttpEvent, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * HttpBackend used only during server-side rendering. Relative `/api/...`
 * requests have no origin on the server, so they're sent to this same Node
 * process (the Express server hosts both the API and the SSR handler).
 *
 * This is done at the backend layer rather than in an interceptor so the
 * HTTP transfer cache still keys responses by the *relative* URL — which is
 * what the browser requests after hydration, letting it reuse the SSR data
 * instead of refetching.
 */
@Injectable()
export class ServerApiFetchBackend extends FetchBackend {
  override handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
    if (req.url.startsWith('/')) {
      const port = process.env['PORT'] || '3000';
      req = req.clone({ url: `http://127.0.0.1:${port}${req.url}` });
    }
    return super.handle(req);
  }
}
