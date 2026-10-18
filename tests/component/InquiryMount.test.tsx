import { afterEach, test, expect, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { mountInquiryForm } from '../../apps/widget/src/mount.js';
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
test('isolated mount waits for the external stylesheet, renders the eight-field form, and unmounts cleanly without touching host siblings', async () => {
  const host = document.createElement('div'),
    sibling = document.createElement('p');
  sibling.textContent = 'Fictional host content';
  document.body.append(host, sibling);
  const config = { gatewayOrigin: 'https://fictional-gateway.example.invalid' },
    widget = mountInquiryForm(host, config),
    shadow = host.shadowRoot!,
    link = shadow.querySelector('link')!;
  expect(link.rel).toBe('stylesheet');
  expect(link.href).toMatch(/inquiry-widget.css$/);
  expect(shadow.querySelector('form')).toBeNull();
  config.gatewayOrigin = 'http://fictional.example.invalid';
  await act(async () => link.dispatchEvent(new Event('load')));
  await waitFor(() =>
    expect(shadow.querySelectorAll('.ak-field')).toHaveLength(8),
  );
  expect(shadow.querySelector('style')).toBeNull();
  expect(sibling.textContent).toBe('Fictional host content');
  expect(() => mountInquiryForm(host, config)).toThrow(
    'Inquiry form unavailable',
  );
  await act(async () => widget.unmount());
  expect(shadow.childNodes).toHaveLength(0);
  expect(sibling.isConnected).toBe(true);
  const second = mountInquiryForm(host, config);
  await act(async () => second.unmount());
});
test('stylesheet failure remains a neutral accessible message; late stylesheet events after unmount cannot render a form', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const widget = mountInquiryForm(host, {
      gatewayOrigin: 'https://fictional-gateway.example.invalid',
    }),
    link = host.shadowRoot!.querySelector('link')!;
  link.dispatchEvent(new Event('error'));
  expect(host.shadowRoot!.querySelector('[role=alert]')?.textContent).toContain(
    'konnte nicht geladen werden',
  );
  widget.unmount();
  link.dispatchEvent(new Event('load'));
  link.dispatchEvent(new Event('error'));
  expect(host.shadowRoot!.childNodes).toHaveLength(0);
});
