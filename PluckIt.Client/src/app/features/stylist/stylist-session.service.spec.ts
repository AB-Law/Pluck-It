import { TestBed } from '@angular/core/testing';
import { StylistSessionService } from './stylist-session.service';

describe('StylistSessionService', () => {
  let service: StylistSessionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StylistSessionService);
  });

  it('seeds greeting once per session', () => {
    service.ensureGreeting('09:00 PM');
    expect(service.messages()).toHaveLength(1);

    service.ensureGreeting('09:30 PM');
    expect(service.messages()).toHaveLength(1);
    expect(service.messages()[0].time).toBe('09:00 PM');
  });
});
