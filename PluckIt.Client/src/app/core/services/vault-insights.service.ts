import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { VaultInsightsResponse } from '../models/vault-insights.model';

@Injectable({ providedIn: 'root' })
export class VaultInsightsService {
  private base = environment.chatApiUrl;

  constructor(private http: HttpClient) {}

  getInsights(windowDays = 90, targetCpw = 100): Observable<VaultInsightsResponse> {
    const params = new HttpParams()
      .set('windowDays', String(windowDays))
      .set('targetCpw', String(targetCpw));
    return this.http.get<VaultInsightsResponse>(`${this.base}/api/insights/vault`, { params });
  }
}

