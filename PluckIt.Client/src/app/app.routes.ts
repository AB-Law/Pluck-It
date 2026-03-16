import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent),
    data: { mobileShell: false },
  },
  {
    path: 'tos',
    loadComponent: () => import('./features/legal/tos.component').then((m) => m.TosComponent),
    data: { mobileShell: false },
  },
  {
    path: 'privacy',
    loadComponent: () => import('./features/legal/privacy.component').then((m) => m.PrivacyComponent),
    data: { mobileShell: false },
  },
  {
    path: '',
    loadComponent: () => import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    canActivate: [authGuard],
  },
  {
    path: 'vault',
    loadComponent: () => import('./features/vault/vault.component').then(m => m.VaultComponent),
    canActivate: [authGuard],
  },
  {
    path: 'collections',
    loadComponent: () => import('./features/collections/collections.component').then(m => m.CollectionsComponent),
    canActivate: [authGuard],
  },
  {
    path: 'discover',
    loadComponent: () => import('./features/discover/discover.component').then(m => m.DiscoverComponent),
    canActivate: [authGuard],
  },
  { path: '**', redirectTo: '' }
];
