import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  Signature,
  CircuitString,
  Poseidon,
  MerkleMap,
} from 'o1js';
import { PostsContract } from './PostsContract';
import {
  PostState,
  fieldToFlagPostsAsDeleted,
  fieldToFlagPostsAsRestored,
} from './Posts';

export async function deployPostsContract(
  deployerAddress: PublicKey,
  deployerKey: PrivateKey,
  postsContract: PostsContract,
  postsContractKey: PrivateKey
) {
  const txn = await Mina.transaction(deployerAddress, () => {
    AccountUpdate.fundNewAccount(deployerAddress);
    postsContract.deploy();
  });
  await txn.prove();
  await txn.sign([deployerKey, postsContractKey]).send();
}

export function createPostPublishingTransitionValidInputs(
  posterAddress: PublicKey,
  posterKey: PrivateKey,
  postContentID: CircuitString,
  allPostsCounter: Field,
  userPostsCounter: Field,
  postBlockHeight: Field,
  usersPostsCountersMap: MerkleMap,
  postsMap: MerkleMap
) {
  const signature = Signature.create(posterKey, [postContentID.hash()]);

  const initialUsersPostsCounters = usersPostsCountersMap.getRoot();
  const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
  const userPostsCounterWitness =
    usersPostsCountersMap.getWitness(posterAddressAsField);

  const initialPosts = postsMap.getRoot();
  const postKey = Poseidon.hash([posterAddressAsField, postContentID.hash()]);
  const postWitness = postsMap.getWitness(postKey);

  const postState = new PostState({
    posterAddress: posterAddress,
    postContentID: postContentID,
    allPostsCounter: allPostsCounter,
    userPostsCounter: userPostsCounter,
    postBlockHeight: postBlockHeight,
    deletionBlockHeight: Field(0),
    restorationBlockHeight: Field(0),
  });

  usersPostsCountersMap.set(posterAddressAsField, userPostsCounter);
  const latestUsersPostsCounters = usersPostsCountersMap.getRoot();

  postsMap.set(postKey, postState.hash());
  const latestPosts = postsMap.getRoot();

  return {
    signature: signature,
    initialUsersPostsCounters: initialUsersPostsCounters,
    latestUsersPostsCounters: latestUsersPostsCounters,
    userPostsCounterWitness: userPostsCounterWitness,
    initialPosts: initialPosts,
    latestPosts: latestPosts,
    postState: postState,
    postWitness: postWitness,
  };
}

export function createPostDeletionTransitionValidInputs(
  posterKey: PrivateKey,
  allPostsCounter: Field,
  initialPostState: PostState,
  deletionBlockHeight: Field,
  usersPostsCountersMap: MerkleMap,
  postsMap: MerkleMap
) {
  const postStateHash = initialPostState.hash();
  const signature = Signature.create(posterKey, [
    postStateHash,
    fieldToFlagPostsAsDeleted,
  ]);

  const usersPostsCounters = usersPostsCountersMap.getRoot();

  const posterAddressAsField = Poseidon.hash(
    initialPostState.posterAddress.toFields()
  );
  const initialPosts = postsMap.getRoot();
  const postKey = Poseidon.hash([
    posterAddressAsField,
    initialPostState.postContentID.hash(),
  ]);
  const postWitness = postsMap.getWitness(postKey);

  const latestPostState = new PostState({
    posterAddress: initialPostState.posterAddress,
    postContentID: initialPostState.postContentID,
    allPostsCounter: initialPostState.allPostsCounter,
    userPostsCounter: initialPostState.userPostsCounter,
    postBlockHeight: initialPostState.postBlockHeight,
    deletionBlockHeight: deletionBlockHeight,
    restorationBlockHeight: initialPostState.restorationBlockHeight,
  });

  postsMap.set(postKey, latestPostState.hash());
  const latestPosts = postsMap.getRoot();

  return {
    signature: signature,
    allPostsCounter: allPostsCounter,
    usersPostsCounters: usersPostsCounters,
    initialPosts: initialPosts,
    latestPosts: latestPosts,
    initialPostState: initialPostState,
    latestPostState: latestPostState,
    postWitness: postWitness,
  };
}

export function createPostRestorationTransitionValidInputs(
  posterKey: PrivateKey,
  allPostsCounter: Field,
  initialPostState: PostState,
  restorationBlockHeight: Field,
  usersPostsCountersMap: MerkleMap,
  postsMap: MerkleMap
) {
  const postStateHash = initialPostState.hash();
  const signature = Signature.create(posterKey, [
    postStateHash,
    fieldToFlagPostsAsRestored,
  ]);

  const usersPostsCounters = usersPostsCountersMap.getRoot();

  const posterAddressAsField = Poseidon.hash(
    initialPostState.posterAddress.toFields()
  );
  const initialPosts = postsMap.getRoot();
  const postKey = Poseidon.hash([
    posterAddressAsField,
    initialPostState.postContentID.hash(),
  ]);
  const postWitness = postsMap.getWitness(postKey);

  const latestPostState = new PostState({
    posterAddress: initialPostState.posterAddress,
    postContentID: initialPostState.postContentID,
    allPostsCounter: initialPostState.allPostsCounter,
    userPostsCounter: initialPostState.userPostsCounter,
    postBlockHeight: initialPostState.postBlockHeight,
    deletionBlockHeight: Field(0),
    restorationBlockHeight: restorationBlockHeight,
  });

  postsMap.set(postKey, latestPostState.hash());
  const latestPosts = postsMap.getRoot();

  return {
    signature: signature,
    allPostsCounter: allPostsCounter,
    usersPostsCounters: usersPostsCounters,
    initialPosts: initialPosts,
    latestPosts: latestPosts,
    initialPostState: initialPostState,
    latestPostState: latestPostState,
    postWitness: postWitness,
    restorationBlockHeight: restorationBlockHeight,
  };
}
