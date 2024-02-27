import {
  Field,
  PrivateKey,
  PublicKey,
  MerkleMap,
  Poseidon,
  Signature,
  Bool,
  Mina,
  AccountUpdate,
} from 'o1js';
import { PostState } from '../posts/Posts';
import { RepostState } from './Reposts.js';
import {
  fieldToFlagTargetAsReposted,
  fieldToFlagRepostsAsDeleted,
  fieldToFlagRepostsAsRestored,
} from './Reposts.js';
import { RepostsContract } from './RepostsContract';

export async function deployRepostsContract(
  deployerAddress: PublicKey,
  deployerKey: PrivateKey,
  repostsContract: RepostsContract,
  repostsContractKey: PrivateKey
) {
  const txn = await Mina.transaction(deployerAddress, () => {
    AccountUpdate.fundNewAccount(deployerAddress);
    repostsContract.deploy();
  });
  await txn.prove();
  await txn.sign([deployerKey, repostsContractKey]).send();
}

export function createRepostTransitionValidInputs(
  targetState: PostState,
  reposterAddress: PublicKey,
  reposterKey: PrivateKey,
  allRepostsCounter: Field,
  userRepostsCounter: Field,
  targetRepostsCounter: Field,
  repostBlockHeight: Field,
  targetsMap: MerkleMap,
  usersRepostsCountersMap: MerkleMap,
  targetsRepostsCountersMap: MerkleMap,
  repostsMap: MerkleMap
) {
  const posterAddressAsField = Poseidon.hash(
    targetState.posterAddress.toFields()
  );
  const postContentIDHash = targetState.postContentID.hash();
  const targetKey = Poseidon.hash([posterAddressAsField, postContentIDHash]);

  const signature = Signature.create(reposterKey, [
    targetKey,
    fieldToFlagTargetAsReposted,
  ]);

  const targets = targetsMap.getRoot();
  const targetWitness = targetsMap.getWitness(
    Poseidon.hash([posterAddressAsField, postContentIDHash])
  );

  const initialUsersRepostsCounters = usersRepostsCountersMap.getRoot();
  const reposterAddressAsField = Poseidon.hash(reposterAddress.toFields());
  usersRepostsCountersMap.set(reposterAddressAsField, userRepostsCounter);
  const latestUsersRepostsCounters = usersRepostsCountersMap.getRoot();
  const userRepostsCounterWitness = usersRepostsCountersMap.getWitness(
    reposterAddressAsField
  );

  const initialTargetsRepostsCounters = targetsRepostsCountersMap.getRoot();
  targetsRepostsCountersMap.set(targetKey, targetRepostsCounter);
  const latestTargetsRepostsCounters = targetsRepostsCountersMap.getRoot();
  const targetRepostsCounterWitness =
    targetsRepostsCountersMap.getWitness(targetKey);

  const repostState = new RepostState({
    isTargetPost: new Bool(true),
    targetKey: targetKey,
    reposterAddress: reposterAddress,
    allRepostsCounter: allRepostsCounter,
    userRepostsCounter: userRepostsCounter,
    targetRepostsCounter: targetRepostsCounter,
    repostBlockHeight: repostBlockHeight,
    deletionBlockHeight: Field(0),
    restorationBlockHeight: Field(0),
  });

  const initialReposts = repostsMap.getRoot();
  const repostKey = Poseidon.hash([targetKey, reposterAddressAsField]);
  repostsMap.set(repostKey, repostState.hash());
  const latestReposts = repostsMap.getRoot();
  const repostWitness = repostsMap.getWitness(repostKey);

  return {
    signature: signature,
    targets: targets,
    targetState: targetState,
    targetWitness: targetWitness,
    initialUsersRepostsCounters: initialUsersRepostsCounters,
    latestUsersRepostsCounters: latestUsersRepostsCounters,
    userRepostsCounterWitness: userRepostsCounterWitness,
    initialTargetsRepostsCounters: initialTargetsRepostsCounters,
    latestTargetsRepostsCounters: latestTargetsRepostsCounters,
    targetRepostsCounterWitness: targetRepostsCounterWitness,
    initialReposts: initialReposts,
    latestReposts: latestReposts,
    repostWitness: repostWitness,
    repostState: repostState,
  };
}

export function createRepostDeletionTransitionValidInputs(
  targetState: PostState,
  reposterKey: PrivateKey,
  allRepostsCounter: Field,
  initialRepostState: RepostState,
  deletionBlockHeight: Field,
  targetsMap: MerkleMap,
  usersRepostsCountersMap: MerkleMap,
  targetsRepostsCountersMap: MerkleMap,
  repostsMap: MerkleMap
) {
  const repostStateHash = initialRepostState.hash();
  const signature = Signature.create(reposterKey, [
    repostStateHash,
    fieldToFlagRepostsAsDeleted,
  ]);

  const targets = targetsMap.getRoot();
  const usersRepostsCounters = usersRepostsCountersMap.getRoot();
  const targetsRepostsCounters = targetsRepostsCountersMap.getRoot();

  const posterAddressAsField = Poseidon.hash(
    targetState.posterAddress.toFields()
  );
  const postContentIDHash = targetState.postContentID.hash();
  const targetKey = Poseidon.hash([posterAddressAsField, postContentIDHash]);

  const targetWitness = targetsMap.getWitness(targetKey);

  const reposterAddressAsField = Poseidon.hash(
    initialRepostState.reposterAddress.toFields()
  );

  const initialReposts = repostsMap.getRoot();

  const repostKey = Poseidon.hash([targetKey, reposterAddressAsField]);
  const repostWitness = repostsMap.getWitness(repostKey);

  const latestRepostState = new RepostState({
    isTargetPost: new Bool(true),
    targetKey,
    reposterAddress: initialRepostState.reposterAddress,
    allRepostsCounter: initialRepostState.allRepostsCounter,
    userRepostsCounter: initialRepostState.userRepostsCounter,
    targetRepostsCounter: initialRepostState.targetRepostsCounter,
    repostBlockHeight: initialRepostState.repostBlockHeight,
    deletionBlockHeight: deletionBlockHeight,
    restorationBlockHeight: initialRepostState.restorationBlockHeight,
  });

  repostsMap.set(repostKey, latestRepostState.hash());
  const latestReposts = repostsMap.getRoot();

  return {
    signature: signature,
    targets: targets,
    targetState: targetState,
    targetWitness: targetWitness,
    allRepostsCounter: allRepostsCounter,
    usersRepostsCounters: usersRepostsCounters,
    targetsRepostsCounters: targetsRepostsCounters,
    initialReposts: initialReposts,
    latestReposts: latestReposts,
    initialRepostState: initialRepostState,
    latestRepostState: latestRepostState,
    repostWitness: repostWitness,
  };
}

export function createRepostRestorationTransitionValidInputs(
  targetState: PostState,
  reposterKey: PrivateKey,
  allRepostsCounter: Field,
  initialRepostState: RepostState,
  restorationBlockHeight: Field,
  targetsMap: MerkleMap,
  usersRepostsCountersMap: MerkleMap,
  targetsRepostsCountersMap: MerkleMap,
  repostsMap: MerkleMap
) {
  const repostStateHash = initialRepostState.hash();
  const signature = Signature.create(reposterKey, [
    repostStateHash,
    fieldToFlagRepostsAsRestored,
  ]);

  const targets = targetsMap.getRoot();
  const usersRepostsCounters = usersRepostsCountersMap.getRoot();
  const targetsRepostsCounters = targetsRepostsCountersMap.getRoot();

  const posterAddressAsField = Poseidon.hash(
    targetState.posterAddress.toFields()
  );
  const postContentIDHash = targetState.postContentID.hash();
  const targetKey = Poseidon.hash([posterAddressAsField, postContentIDHash]);

  const targetWitness = targetsMap.getWitness(targetKey);

  const reposterAddressAsField = Poseidon.hash(
    initialRepostState.reposterAddress.toFields()
  );

  const initialReposts = repostsMap.getRoot();

  const repostKey = Poseidon.hash([targetKey, reposterAddressAsField]);
  const repostWitness = repostsMap.getWitness(repostKey);

  const latestRepostState = new RepostState({
    isTargetPost: new Bool(true),
    targetKey,
    reposterAddress: initialRepostState.reposterAddress,
    allRepostsCounter: initialRepostState.allRepostsCounter,
    userRepostsCounter: initialRepostState.userRepostsCounter,
    targetRepostsCounter: initialRepostState.targetRepostsCounter,
    repostBlockHeight: initialRepostState.repostBlockHeight,
    deletionBlockHeight: Field(0),
    restorationBlockHeight: restorationBlockHeight,
  });

  repostsMap.set(repostKey, latestRepostState.hash());
  const latestReposts = repostsMap.getRoot();

  return {
    signature: signature,
    targets: targets,
    targetState: targetState,
    targetWitness: targetWitness,
    allRepostsCounter: allRepostsCounter,
    usersRepostsCounters: usersRepostsCounters,
    targetsRepostsCounters: targetsRepostsCounters,
    initialReposts: initialReposts,
    latestReposts: latestReposts,
    initialRepostState: initialRepostState,
    latestRepostState: latestRepostState,
    repostWitness: repostWitness,
  };
}
