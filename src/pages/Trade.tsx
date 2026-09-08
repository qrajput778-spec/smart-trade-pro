import { useParams } from 'react-router-dom'

export default function Trade() {
  const { symbol } = useParams<{ symbol: string }>()
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Trade {symbol?.toUpperCase()}</h1>
    </div>
  )
}
