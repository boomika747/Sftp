import { Suspense } from "react";
import FileManager from "./components/file-manager";
import FileListSkeleton from "./components/file-list-skeleton";

export default function Home() {
  return (
    <Suspense fallback={<FileListSkeleton />}>
      <FileManager initialPath="/upload" />
    </Suspense>
  );
}
