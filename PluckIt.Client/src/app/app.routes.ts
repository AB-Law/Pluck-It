import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { TosComponent } from './features/legal/tos.component';
import { PrivacyComponent } from './features/legal/privacy.component';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'tos', component: TosComponent },
  { path: 'privacy', component: PrivacyComponent },
  { path: '', component: DashboardComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' }
];
