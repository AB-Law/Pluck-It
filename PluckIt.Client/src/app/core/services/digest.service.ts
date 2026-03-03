import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  DigestFeedbackRequest,
  WardrobeDigest,
} from '../models/digest.model';

@Injectable({ providedIn: 'root' })
export class DigestService {
  private base = environment.chatApiUrl;

  constructor(private http: HttpClient) {}

  getLatest(): Observable<{ digest: WardrobeDigest | null }> {
    return this.http.get<{ digest: WardrobeDigest | null }>(
      `${this.base}/api/digest/latest`
    );
  }

  getFeedback(digestId: string): Observable<{ feedback: { suggestionIndex: number; signal: string }[] }> {
    return this.http.get<{ feedback: { suggestionIndex: number; signal: string }[] }>(
      `${this.base}/api/digest/feedback`,
      { params: { digestId } }
    );
  }

  sendFeedback(body: DigestFeedbackRequest): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(
      `${this.base}/api/digest/feedback`,
      body
    );
  }
}
