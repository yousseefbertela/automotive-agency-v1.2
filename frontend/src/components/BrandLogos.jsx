/**
 * Moving bar with car brand logos (images provided by user in chat).
 * BMW stays highlighted in center only (MessageList empty state).
 */
const LOGOS = [
  { src: '/logo-rollsroyce.png', alt: 'Rolls-Royce' },
  { src: '/logo-lamborghini.png', alt: 'Lamborghini' },
  { src: '/logo-bugatti.png', alt: 'Bugatti' },
  { src: '/logo-mercedes.png', alt: 'Mercedes-Benz' },
  { src: '/logo-cadillac.png', alt: 'Cadillac' },
  { src: '/logo-koenigsegg.png', alt: 'Koenigsegg' },
  { src: '/logo-maserati.png', alt: 'Maserati' },
  { src: '/logo-ferrari.png', alt: 'Ferrari' },
];

export default function BrandLogos() {
  /* 4 copies so track is always full (no empty gap) and loop is seamless */
  const list = [...LOGOS, ...LOGOS, ...LOGOS, ...LOGOS];
  return (
    <div className="brand-logos-wrap" aria-hidden>
      <div className="brand-logos-track">
        {list.map(({ src, alt }, i) => (
          <div key={`${alt}-${i}`} className="brand-logo-item">
            <img src={src} alt={alt} className="brand-logo-img" />
          </div>
        ))}
      </div>
    </div>
  );
}
