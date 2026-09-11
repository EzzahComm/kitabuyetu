import { cn, formatKES } from '@/lib/utils';

interface MoneyDisplayProps {
  amount:    number;
  className?: string;
  size?:     'sm' | 'md' | 'lg' | 'xl';
  color?:    'default' | 'green' | 'red';
}

const sizeMap = { sm: 'text-sm', md: 'text-base', lg: 'text-xl font-semibold', xl: 'text-2xl font-bold' };
const colorMap = { default: '', green: 'text-green-600', red: 'text-red-600' };

export function MoneyDisplay({ amount, className, size = 'md', color = 'default' }: MoneyDisplayProps) {
  return (
    <span className={cn(sizeMap[size], colorMap[color], 'font-mono tabular-nums', className)}>
      {formatKES(amount)}
    </span>
  );
}
