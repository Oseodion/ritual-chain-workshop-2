import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { localHardhat } from "./chain";

export const wagmiConfig = createConfig({
  chains: [localHardhat],
  connectors: [injected()],
  transports: {
    [localHardhat.id]: http("http://127.0.0.1:8545"),
  },
});

export const PREDICT_ADDRESS = process.env
  .NEXT_PUBLIC_PREDICT_ADDRESS as `0x${string}` | undefined;
