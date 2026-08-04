import Image, {
  type ImageProps,
} from "next/image";

type MovieImageProps =
  Omit<ImageProps, "width" | "height"> & {
    width?: number;
    height?: number;
  };

export default function MovieImage({
  src,
  alt,
  width = 500,
  height = 750,
  sizes = "(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 280px",
  unoptimized,
  ...props
}: MovieImageProps) {
  const skipOptimization =
    unoptimized ??
    (
      typeof src === "string" &&
      src.endsWith(".svg")
    );

  return (
    <Image
      {...props}
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      unoptimized={skipOptimization}
    />
  );
}