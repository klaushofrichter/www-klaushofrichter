export interface Link {
  id: string;
  title: string;
  url: string;
  abstract: string;
  gradient: string;
  requiresAuth?: boolean;
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
  {
    id: 'status',
    title: 'Status',
    url: 'https://status.klaushofrichter.net',
    abstract: 'Live uptime and status monitoring for my services.',
    gradient: 'linear-gradient(135deg, #16a34a, #0891b2)',
    requiresAuth: true,
  },
  {
    id: 'headlamp',
    title: 'Headlamp',
    url: 'https://headlamp.skylar.technology',
    abstract: 'Kubernetes cluster dashboard for the Skylar Technology infrastructure.',
    gradient: 'linear-gradient(135deg, #ea580c, #2563eb)',
    requiresAuth: true,
  },
  {
    id: 'headlamp-repo',
    title: 'Headlamp (GitHub)',
    url: 'https://github.com/kubernetes-sigs/headlamp',
    abstract: 'Open-source Kubernetes web UI project used for cluster monitoring.',
    gradient: 'linear-gradient(135deg, #1f2937, #374151)',
    requiresAuth: true,
  },
  {
    id: 'grafana',
    title: 'Grafana',
    url: 'https://klaushofrichter.grafana.net/d/kl9nd7q/skylar-technology-node-overview',
    abstract: 'Node metrics dashboard for the Skylar Technology cluster.',
    gradient: 'linear-gradient(135deg, #f97316, #eab308)',
    requiresAuth: true,
  },
  {
    id: 'steps',
    title: 'Steps',
    url: 'https://steps.skylar.technology',
    abstract: 'Personal step count and Claude usage status dashboard.',
    gradient: 'linear-gradient(135deg, #000000, #3a3a3a)',
    requiresAuth: true,
  },
  {
    id: 'ghpages',
    title: 'GitHub Pages Apps',
    url: 'https://klaushofrichter.github.io/klaushofrichter',
    abstract: 'A collection of small deployed apps and demos.',
    gradient: 'linear-gradient(135deg, #6b7280, #9ca3af)',
    requiresAuth: true,
  },
];
