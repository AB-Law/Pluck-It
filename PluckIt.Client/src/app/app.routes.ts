import { Routes } from '@angular/router';
import { ClosetComponent } from './features/closet/closet.component';
import { StylistComponent } from './features/stylist/stylist.component';

export const routes: Routes = [
  { path: '', component: ClosetComponent },
  { path: 'stylist', component: StylistComponent },
  { path: '**', redirectTo: '' }
];
