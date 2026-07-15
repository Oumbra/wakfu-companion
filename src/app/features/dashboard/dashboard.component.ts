import { Component } from '@angular/core';
import { DamageMeterComponent } from '../damage-meter/damage-meter.component';
import { ChatPanelComponent } from '../chat-panel/chat-panel.component';
import { TrackerComponent } from '../tracker/tracker.component';

@Component({
  selector: 'app-dashboard',
  imports: [DamageMeterComponent, TrackerComponent, ChatPanelComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {}
