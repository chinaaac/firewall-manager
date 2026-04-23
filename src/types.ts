export interface Machine {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  tags: string[];
  configPath: string; // Path to the configuration file (e.g. /etc/iptables/rules.v4)
  restartCommand: string; // Command to apply rules (e.g. iptables-restore < /etc/iptables/rules.v4)
}

export interface IptablesRule {
  num: string;
  pkts: string;
  bytes: string;
  target: string;
  prot: string;
  opt: string;
  in: string;
  out: string;
  source: string;
  destination: string;
  extra?: string;
}

export interface Chain {
  name: string;
  policy: string;
  rules: IptablesRule[];
}
