import { Routes } from '@angular/router';
import { ClosetGridComponent } from './features/closet-grid/closet-grid.component';
import { StylistChatComponent } from './features/stylist-chat/stylist-chat.component';

export const routes: Routes = [
  { path: '', component: ClosetGridComponent },
  { path: 'stylist', component: StylistChatComponent },
  { path: '**', redirectTo: '' },
];

