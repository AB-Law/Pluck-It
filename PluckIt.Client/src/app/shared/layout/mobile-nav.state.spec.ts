import { MobileNavState } from './mobile-nav.state';

describe('MobileNavState', () => {
  let state: MobileNavState;

  beforeEach(() => {
    state = new MobileNavState();
  });

  it('starts with no active panel', () => {
    expect(state.activePanel()).toBe('none');
  });

  it('opens and closes the profile panel', () => {
    state.openProfile();
    expect(state.activePanel()).toBe('profile');

    state.closePanel();
    expect(state.activePanel()).toBe('none');
  });

  it('opens and closes the digest panel', () => {
    state.openDigest();
    expect(state.activePanel()).toBe('digest');

    state.closePanel();
    expect(state.activePanel()).toBe('none');
  });
});
