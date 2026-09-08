import Card from './Card'

interface FeatureCardProps {
  index: string
  label: string
  title: string
  description: string
}

export default function FeatureCard({ index, label, title, description }: FeatureCardProps) {
  return (
    <Card className="hover:border-accent-gold/40 transition-colors">
      <p className="font-mono text-xs text-accent-gold tracking-wide">
        {index}/{label}
      </p>
      <h3 className="mt-4 text-lg font-semibold text-text-primary">{title}</h3>
      <p className="mt-2 text-sm text-text-muted leading-relaxed">{description}</p>
    </Card>
  )
}
