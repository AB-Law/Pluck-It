import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { TosComponent } from './features/legal/tos.component';
import { PrivacyComponent } from './features/legal/privacy.component';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, data: { mobileShell: false } },
  { path: 'tos', component: TosComponent, data: { mobileShell: false } },
  { path: 'privacy', component: PrivacyComponent, data: { mobileShell: false } },
  { path: '', component: DashboardComponent, canActivate: [authGuard] },
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
