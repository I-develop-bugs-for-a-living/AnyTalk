import { For, Show } from "solid-js";

import { styled } from "styled-system/jsx";

import { useUser } from "@revolt/markdown/users";
import { useVoice } from "@revolt/rtc";
import { Avatar } from "@revolt/ui/components/design";

/** More viewers than this only show as a count */
const MAX_AVATARS = 6;

/**
 * Avatars of everyone watching a stream
 */
export function StreamViewerList(props: { streamer: string }) {
  const voice = useVoice();

  const viewers = () => voice.viewersOf(props.streamer);
  const rest = () => viewers().length - MAX_AVATARS;

  return (
    <Show when={viewers().length}>
      <List>
        <For each={viewers().slice(0, MAX_AVATARS)}>
          {(id) => <Viewer id={id} />}
        </For>
        <Show when={rest() > 0}>
          <More>+{rest()}</More>
        </Show>
      </List>
    </Show>
  );
}

function Viewer(props: { id: string }) {
  // eslint-disable-next-line solid/reactivity
  const user = useUser(props.id);

  return (
    <Ring
      data-viewer
      use:floating={{
        tooltip: { placement: "bottom", content: user().username },
      }}
    >
      <Avatar
        src={user().avatar}
        fallback={user().username}
        size={28}
        interactive={false}
      />
    </Ring>
  );
}

const List = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    // each viewer overlaps the one before
    "& > [data-viewer]:not(:first-child)": {
      marginInlineStart: "-8px",
    },
  },
});

const Ring = styled("div", {
  base: {
    display: "flex",
    borderRadius: "50%",
    boxShadow: "0 0 0 2px #000a",
  },
});

const More = styled("div", {
  base: {
    marginInlineStart: "var(--gap-sm)",
    color: "white",
    fontSize: "0.8125rem",
    fontWeight: 600,
  },
});
