import { CanActivateFn } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

/**
 * Route guard that ensures the user is authenticated.
 * If not, redirects to the Google login page via EasyAuth.
 * In development, the AuthService sets a mock user during initialization
 * so this guard always passes locally.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);

  if (auth.isAuthenticated()) {
    return true;
  }

  auth.login();
  return false;
};
