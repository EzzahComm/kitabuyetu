import { renderToStaticMarkup } from 'react-dom/server';
import { X } from 'lucide-react';
import { WhatsAppLogo, XLogo } from '@/components/marketing/brand-icons';
import { SocialLinks } from '@/components/marketing/social-links';

const X_PATH = 'M4 4l11.733 16h4.267l-11.733 -16l-4.267 0';
const WHATSAPP_PATH = 'M3 21l1.65 -3.8a9 9 0 1 1 3.4 2.9l-5.05 .9';

describe('brand icons', () => {
  it('draw the logos and honour size and strokeWidth like other icons', () => {
    const x = renderToStaticMarkup(<XLogo size={16} strokeWidth={1.75} />);
    expect(x).toContain(X_PATH);
    expect(x).toContain('width="16"');
    expect(x).toContain('stroke-width="1.75"');
    expect(renderToStaticMarkup(<WhatsAppLogo />)).toContain(WHATSAPP_PATH);
  });

  it('are not lucide close icon', () => {
    expect(renderToStaticMarkup(<X />)).not.toContain(X_PATH);
  });

  it('SocialLinks renders the X and WhatsApp logos for those platforms', () => {
    const html = renderToStaticMarkup(
      <SocialLinks
        variant="footer"
        links={[
          { platform: 'x', label: 'X', href: 'https://x.com/example' },
          { platform: 'whatsapp', label: 'WhatsApp', href: 'https://wa.me/254700000000' },
        ]}
      />,
    );
    expect(html).toContain(X_PATH);
    expect(html).toContain(WHATSAPP_PATH);
  });
});
