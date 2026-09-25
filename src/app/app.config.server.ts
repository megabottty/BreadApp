import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { HttpBackend } from '@angular/common/http';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { ServerApiFetchBackend } from './server/server-api-fetch.backend';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // Route relative /api calls to this same process while rendering (see class docs)
    { provide: HttpBackend, useClass: ServerApiFetchBackend }
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
