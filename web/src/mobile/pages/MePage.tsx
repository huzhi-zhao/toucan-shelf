import { BlockFooter, BlockTitle, List, ListButton, ListItem, Navbar, Page } from "konsta/react";
import { useNavigate } from "react-router-dom";
import UserAvatar from "@/components/UserAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { COPY } from "../copy";
import { READER_FONT_SIZE_DEFAULT, READER_FONT_SIZE_KEY } from "../lib/reading";
import { usePref } from "../lib/storage";
import { MOBILE_ROUTES } from "../routes";

export default function MePage() {
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();
  const [fontSize] = usePref(READER_FONT_SIZE_KEY, READER_FONT_SIZE_DEFAULT);

  const signOut = async () => {
    await logout();
    navigate(MOBILE_ROUTES.AUTH, { replace: true });
  };

  return (
    <Page className="pb-tabbar">
      <Navbar title={COPY.me.title} large transparent centerTitle />
      <List strongIos insetIos className="mt-4">
        <ListItem
          title={currentUser?.displayName || currentUser?.username}
          text={currentUser?.username}
          media={<UserAvatar className="w-11 h-11" avatarUrl={currentUser?.avatarUrl} />}
        />
      </List>
      <BlockTitle className="mt-8">{COPY.me.reading}</BlockTitle>
      <List strongIos insetIos>
        <ListItem title={COPY.me.fontSize} after={`${fontSize}px`} />
        <ListItem title={COPY.me.darkMode} after={COPY.me.followSystem} />
      </List>
      <BlockFooter>{COPY.me.readingHint}</BlockFooter>
      <List strongIos insetIos>
        <ListItem title={COPY.me.homeScreen} text={<span className="whitespace-normal">{COPY.me.homeScreenHint}</span>} />
      </List>
      <List strongIos insetIos>
        <ListButton className="text-red-500" onClick={signOut}>
          {COPY.me.signOut}
        </ListButton>
      </List>
    </Page>
  );
}
