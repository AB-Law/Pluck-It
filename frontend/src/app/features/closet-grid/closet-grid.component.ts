import { Component, OnInit, computed } from '@angular/core';
import { NgFor, NgIf, NgClass } from '@angular/common';
import { WardrobeService } from '../../core/wardrobe.service';

@Component({
  selector: 'app-closet-grid',
  standalone: true,
  imports: [NgFor, NgIf, NgClass],
  templateUrl: './closet-grid.component.html',
})
export class ClosetGridComponent implements OnInit {
  items = computed(() => this.wardrobeService.wardrobe());

  constructor(private readonly wardrobeService: WardrobeService) {}

  ngOnInit(): void {
    this.wardrobeService.loadWardrobe();
  }
}

