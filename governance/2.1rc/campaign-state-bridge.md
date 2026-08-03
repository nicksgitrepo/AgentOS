# Campaign State Bridge

The lifecycle controller and the first-pass/audit cascade are separate state machines because they answer different questions. They must not become separate authorities.

At a state boundary, AgentOS can compile one bridge receipt containing both compact state identities. The receipt compares campaign ID, campaign version, logical lineage, policy epoch, policy snapshot, complete acceptance contract, stage, and each state digest. A mismatch fails closed. The serialization rule is `ONE_SERIALIZED_STATE_TRANSITION`, so the two controllers cannot independently advance one half of a campaign.
