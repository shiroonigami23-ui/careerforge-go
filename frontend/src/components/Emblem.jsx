export default function Emblem({ size = 32, className = '' }) {
  return <img src="/emblem.png" width={size} height={size} alt="" className={`emblem ${className}`} />;
}
