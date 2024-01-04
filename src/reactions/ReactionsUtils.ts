import {
  Field,
  PrivateKey,
  PublicKey,
  MerkleMap,
  Poseidon,
  Signature,
  Bool,
} from 'o1js';
import { PostState } from '../posts/Posts';
import { ReactionState } from './Reactions.js';

export function createReactionTransitionValidInputs(
  targetState: PostState,
  reactorAddress: PublicKey,
  reactorKey: PrivateKey,
  reactionCodePoint: Field,
  allReactionsCounter: Field,
  userReactionsCounter: Field,
  targetReactionsCounter: Field,
  reactionBlockHeight: Field,
  postsMap: MerkleMap,
  usersReactionsCountersMap: MerkleMap,
  targetsReactionsCountersMap: MerkleMap,
  reactionsMap: MerkleMap
) {
  const posterAddressAsField = Poseidon.hash(
    targetState.posterAddress.toFields()
  );
  const postContentIDHash = targetState.postContentID.hash();
  const targetKey = Poseidon.hash([posterAddressAsField, postContentIDHash]);

  const signature = Signature.create(reactorKey, [
    targetKey,
    reactionCodePoint,
  ]);

  const targetWitness = postsMap.getWitness(
    Poseidon.hash([posterAddressAsField, postContentIDHash])
  );

  const initialUsersReactionsCounters = usersReactionsCountersMap.getRoot();
  const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
  usersReactionsCountersMap.set(reactorAddressAsField, userReactionsCounter);
  const latestUsersReactionsCounters = usersReactionsCountersMap.getRoot();
  const userReactionsCounterWitness = usersReactionsCountersMap.getWitness(
    reactorAddressAsField
  );

  const initialTargetsReactionsCounters = targetsReactionsCountersMap.getRoot();
  targetsReactionsCountersMap.set(targetKey, targetReactionsCounter);
  const latestTargetsReactionsCounters = targetsReactionsCountersMap.getRoot();
  const targetReactionsCounterWitness =
    targetsReactionsCountersMap.getWitness(targetKey);

  const reactionState = new ReactionState({
    isTargetPost: new Bool(true),
    targetKey: targetKey,
    reactorAddress: reactorAddress,
    reactionCodePoint: reactionCodePoint,
    allReactionsCounter: allReactionsCounter,
    userReactionsCounter: userReactionsCounter,
    targetReactionsCounter: targetReactionsCounter,
    reactionBlockHeight: reactionBlockHeight,
    deletionBlockHeight: Field(0),
    restorationBlockHeight: Field(0),
  });

  const initialReactions = reactionsMap.getRoot();
  const reactionKey = Poseidon.hash([
    targetKey,
    reactorAddressAsField,
    reactionCodePoint,
  ]);
  reactionsMap.set(reactionKey, reactionState.hash());
  const latestReactions = reactionsMap.getRoot();
  const reactionWitness = reactionsMap.getWitness(reactionKey);

  return {
    signature: signature,
    targetState: targetState,
    targetWitness: targetWitness,
    initialUsersReactionsCounters: initialUsersReactionsCounters,
    latestUsersReactionsCounters: latestUsersReactionsCounters,
    userReactionsCounterWitness: userReactionsCounterWitness,
    initialTargetsReactionsCounters: initialTargetsReactionsCounters,
    latestTargetsReactionsCounters: latestTargetsReactionsCounters,
    targetReactionsCounterWitness: targetReactionsCounterWitness,
    initialReactions: initialReactions,
    latestReactions: latestReactions,
    reactionWitness: reactionWitness,
    reactionState: reactionState,
  };
}
