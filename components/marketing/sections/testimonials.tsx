import bernardKisakaPhoto from '@/public/img/testimonials/bernard-kisaka.jpg';
import ezraWekesaPhoto from '@/public/img/testimonials/ezra-wekesa.jpg';
import { FinanzaHeading, FinanzaSection } from '../finanza';
import { TestimonialCarousel, type Testimonial } from '../testimonial-carousel';

/** Real quotes from real groups; photos only where the person supplied one. */
export const TESTIMONIALS: Testimonial[] = [
  {
    quote: 'Kitabu Yetu has been a game changer for accountability and transparency in our group.',
    name: 'Ezra Wekesa',
    title: 'Coordinator, Munyali Ukulima Self Help Group',
    image: ezraWekesaPhoto,
  },
  {
    quote: 'It has made mobilizing our members much easier and managing the group more efficient.',
    name: 'Bernard Kisaka',
    title: 'Musikoma Home Owners Welfare Association',
    image: bernardKisakaPhoto,
  },
  {
    quote: 'Manually updating contributions is a thing of the past.',
    name: 'Britney Mideva',
    title: 'Treasurer, The Fionas',
  },
  {
    quote: 'Meeting attendance has improved and timely contributions are becoming the norm.',
    name: 'Joseph Bienda',
    title: 'Chairperson, Capital Point Chama',
  },
];

export function TestimonialsSection() {
  return (
    <FinanzaSection labelledBy="testimonials-heading">
      <FinanzaHeading
        id="testimonials-heading"
        align="center"
        pill="Testimonials"
        title="Trusted by treasurers and chairs"
        className="mb-10"
      />
      <TestimonialCarousel items={TESTIMONIALS} />
    </FinanzaSection>
  );
}
