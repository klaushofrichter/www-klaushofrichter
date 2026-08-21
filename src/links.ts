export interface Link {
  id: string;
  title: string;
  url: string;
  abstract: string;
  gradient: string;
}

export const links: Link[] = [
  {
    id: 'linkedin',
    title: 'LinkedIn',
    url: 'https://www.linkedin.com/in/klaushofrichter',
    abstract: 'Professional profile, career history, and updates.',
    gradient: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
  },
  {
    id: 'github',
    title: 'GitHub',
    url: 'https://github.com/klaushofrichter',
    abstract: 'Open-source projects, code, and experiments.',
    gradient: 'linear-gradient(135deg, #1f2937, #374151)',
  },
  {
    id: 'portfolio2017',
    title: 'Portfolio 2017',
    url: 'https://klaushofrichter.wordpress.com',
    abstract: 'An earlier portfolio and blog archive.',
    gradient: 'linear-gradient(135deg, #6b7280, #9ca3af)',
  },
  {
    id: 'instagram',
    title: 'Instagram',
    url: 'https://www.instagram.com/klaushofrichter',
    abstract: 'Photos and moments, shared casually.',
    gradient: 'linear-gradient(135deg, #f97316, #ec4899)',
  },
  {
    id: 'threepuppies',
    title: 'Three Puppies',
    url: 'https://three-pups.mystrikingly.com',
    abstract: 'A small site about three very good dogs.',
    gradient: 'linear-gradient(135deg, #059669, #10b981)',
  },
  {
    id: 'medium',
    title: 'Medium',
    url: 'https://medium.com/@klaushofrichter',
    abstract: 'Articles and longer-form writing.',
    gradient: 'linear-gradient(135deg, #000000, #3a3a3a)',
  },
  {
    id: 'skylar',
    title: 'Skylar Technology',
    url: 'https://www.skylar.technology',
    abstract: 'Skylar Technology LLC.',
    gradient: 'linear-gradient(135deg, #ea580c, #2563eb)',
  },
];
