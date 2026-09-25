import { APP_INITIALIZER, ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withPreloading } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { errorInterceptor } from './interceptors/error.interceptor';
import { RuntimeConfigService } from './services/runtime-config.service';
import { SelectivePreloadingService } from './services/selective-preloading.service';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAnimationsAsync(),
    provideRouter(routes, withPreloading(SelectivePreloadingService)),
    provideHttpClient(
      withFetch(),
      withInterceptors([errorInterceptor])
    ),
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [RuntimeConfigService],
      useFactory: (runtimeConfig: RuntimeConfigService) => () => runtimeConfig.load()
    }, provideClientHydration(withEventReplay())
  ]
};
