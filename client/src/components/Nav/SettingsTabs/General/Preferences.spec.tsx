import 'test/matchMedia.mock';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { RecoilRoot } from 'recoil';
import { useRecoilValue } from 'recoil';

import Preferences from './Preferences';
import store from '~/store';

// Drive ControlCombobox directly: render one button per option that calls
// setValue(value), keyed by ariaLabel so tests can target a specific selector.
jest.mock('@librechat/client', () => ({
  ControlCombobox: ({
    ariaLabel,
    items,
    setValue,
  }: {
    ariaLabel: string;
    items: { value: string; label: string }[];
    setValue: (v: string) => void;
  }) => (
    <div>
      {items.map((it) => (
        <button
          key={`${ariaLabel}:${it.value}`}
          data-testid={`${ariaLabel}::${it.value}`}
          onClick={() => setValue(it.value)}
        >
          {it.label}
        </button>
      ))}
    </div>
  ),
}));

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  getModelName: (m: string) => m,
}));

jest.mock('librechat-data-provider/react-query', () => ({
  useGetModelsQuery: () => ({ data: { openAI: ['gpt-x'] } }),
}));

jest.mock('~/data-provider', () => ({
  useListAgentsQuery: () => ({ data: [{ value: 'agent1', label: 'Agent One' }] }),
}));

jest.mock('~/hooks', () => ({
  useAgentDefaultPermissionLevel: () => 'VIEW',
}));

function Probe() {
  const model = useRecoilValue(store.defaultChatModel);
  const persona = useRecoilValue(store.defaultPersona);
  return <div data-testid="probe" data-model={model} data-persona={persona} />;
}

function setup() {
  const utils = render(
    <RecoilRoot>
      <Preferences />
      <Probe />
    </RecoilRoot>,
  );
  const probe = () => utils.getByTestId('probe');
  const model = () => probe().getAttribute('data-model');
  const persona = () => probe().getAttribute('data-persona');
  // The model + personas share one dropdown; personas use a "persona:" value.
  const ARIA = 'Default chat model or persona';
  const pick = (value: string) => fireEvent.click(utils.getByTestId(`${ARIA}::${value}`));
  return { ...utils, model, persona, pick };
}

describe('Preferences — combined default model / persona dropdown', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('selecting a model sets the model and clears any persona', () => {
    const { pick, model, persona } = setup();

    pick('persona:agent1');
    expect(persona()).toBe('agent1');

    pick('gpt-x');
    expect(model()).toBe('gpt-x');
    expect(persona()).toBe('');
  });

  it('selecting a persona sets the persona and clears any model', () => {
    const { pick, model, persona } = setup();

    pick('gpt-x');
    expect(model()).toBe('gpt-x');

    pick('persona:agent1');
    expect(persona()).toBe('agent1');
    expect(model()).toBe('');
  });

  it('persists the selected default model to localStorage', () => {
    const { pick } = setup();
    pick('gpt-x');
    // atomWithLocalStorage JSON-stringifies the value under the atom key.
    expect(localStorage.getItem('defaultChatModel')).toBe(JSON.stringify('gpt-x'));
  });

  it('choosing "Default" (empty) clears both model and persona', () => {
    const { pick, model, persona } = setup();

    pick('persona:agent1');
    pick(''); // the empty "Default" option
    expect(model()).toBe('');
    expect(persona()).toBe('');
  });
});
