import { Routes } from '@angular/router';
import { ClosetComponent } from './features/closet/closet.component';
import { StylistComponent } from './features/stylist/stylist.component';
import { LoginComponent } from './features/auth/login.component';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: '', component: ClosetComponent, canActivate: [authGuard] },
  { path: 'stylist', component: StylistComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' }
];
