import { createRoot, type Root } from 'react-dom/client';
import { InquiryForm } from './InquiryForm.js';
import './inquiry-form.css';
export function mountInquiryForm(
  host: HTMLElement,
  options: { gatewayOrigin: string },
) {
  const gatewayOrigin = options.gatewayOrigin;
  const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (shadowRoot.childNodes.length) throw new Error('Inquiry form unavailable');
  const link = document.createElement('link'),
    fallback = document.createElement('p'),
    container = document.createElement('div'),
    sourceUrl = import.meta.url;
  let root: Root | undefined;
  link.rel = 'stylesheet';
  link.href = new URL('inquiry-widget.css', sourceUrl).href;
  fallback.setAttribute('role', 'status');
  fallback.textContent = 'Formular wird geladen …';
  link.onload = () => {
    link.onload = null;
    link.onerror = null;
    fallback.remove();
    root = createRoot(container);
    root.render(<InquiryForm gatewayOrigin={gatewayOrigin} />);
  };
  link.onerror = () => {
    fallback.setAttribute('role', 'alert');
    fallback.textContent =
      'Das Formular konnte nicht geladen werden. Bitte öffnen Sie die Seite erneut.';
  };
  shadowRoot.append(link, fallback, container);
  return {
    unmount() {
      link.onload = null;
      link.onerror = null;
      root?.unmount();
      shadowRoot.replaceChildren();
    },
  };
}
