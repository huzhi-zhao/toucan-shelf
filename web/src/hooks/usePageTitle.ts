import { useEffect } from "react";
import { useInstance } from "@/contexts/InstanceContext";

const usePageTitle = (title?: string) => {
  const { generalSetting } = useInstance();
  const brand = generalSetting.customProfile?.title || "ToucanShelf";

  useEffect(() => {
    document.title = title ? `${title} - ${brand}` : brand;
  }, [title, brand]);
};

export default usePageTitle;
