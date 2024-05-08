import {
  Field,
  PrivateKey,
  PublicKey,
  MerkleMap,
  Poseidon,
  Signature,
  Bool,
  CircuitString,
  Mina,
  AccountUpdate,
} from 'o1js';
import { PostState } from '../posts/Posts';
import {
  CommentState,
  fieldToFlagCommentsAsDeleted,
  fieldToFlagCommentsAsRestored,
} from './Comments.js';
import { CommentsContract } from './CommentsContract';

export async function deployCommentsContract(
  deployerAddress: PublicKey,
  deployerKey: PrivateKey,
  commentsContract: CommentsContract,
  commentsContractKey: PrivateKey
) {
  const txn = await Mina.transaction(deployerAddress, async () => {
    AccountUpdate.fundNewAccount(deployerAddress);
    commentsContract.deploy();
  });
  await txn.prove();
  await txn.sign([deployerKey, commentsContractKey]).send();
}

export function createCommentTransitionValidInputs(
  targetState: PostState,
  commenterAddress: PublicKey,
  commenterKey: PrivateKey,
  commentContentID: CircuitString,
  allCommentsCounter: Field,
  userCommentsCounter: Field,
  targetCommentsCounter: Field,
  commentBlockHeight: Field,
  targetsMap: MerkleMap,
  usersCommentsCountersMap: MerkleMap,
  targetsCommentsCountersMap: MerkleMap,
  commentsMap: MerkleMap
) {
  const posterAddressAsField = Poseidon.hash(
    targetState.posterAddress.toFields()
  );
  const postContentIDHash = targetState.postContentID.hash();
  const targetKey = Poseidon.hash([posterAddressAsField, postContentIDHash]);

  const signature = Signature.create(commenterKey, [
    targetKey,
    commentContentID.hash(),
  ]);

  const targets = targetsMap.getRoot();
  const targetWitness = targetsMap.getWitness(
    Poseidon.hash([posterAddressAsField, postContentIDHash])
  );

  const initialUsersCommentsCounters = usersCommentsCountersMap.getRoot();
  const commenterAddressAsField = Poseidon.hash(commenterAddress.toFields());
  usersCommentsCountersMap.set(commenterAddressAsField, userCommentsCounter);
  const latestUsersCommentsCounters = usersCommentsCountersMap.getRoot();
  const userCommentsCounterWitness = usersCommentsCountersMap.getWitness(
    commenterAddressAsField
  );

  const initialTargetsCommentsCounters = targetsCommentsCountersMap.getRoot();
  targetsCommentsCountersMap.set(targetKey, targetCommentsCounter);
  const latestTargetsCommentsCounters = targetsCommentsCountersMap.getRoot();
  const targetCommentsCounterWitness =
    targetsCommentsCountersMap.getWitness(targetKey);

  const commentState = new CommentState({
    isTargetPost: new Bool(true),
    targetKey: targetKey,
    commenterAddress: commenterAddress,
    commentContentID: commentContentID,
    allCommentsCounter: allCommentsCounter,
    userCommentsCounter: userCommentsCounter,
    targetCommentsCounter: targetCommentsCounter,
    commentBlockHeight: commentBlockHeight,
    deletionBlockHeight: Field(0),
    restorationBlockHeight: Field(0),
  });

  const initialComments = commentsMap.getRoot();
  const commentKey = Poseidon.hash([
    targetKey,
    commenterAddressAsField,
    commentContentID.hash(),
  ]);
  commentsMap.set(commentKey, commentState.hash());
  const latestComments = commentsMap.getRoot();
  const commentWitness = commentsMap.getWitness(commentKey);

  return {
    signature: signature,
    targets: targets,
    targetState: targetState,
    targetWitness: targetWitness,
    initialUsersCommentsCounters: initialUsersCommentsCounters,
    latestUsersCommentsCounters: latestUsersCommentsCounters,
    userCommentsCounterWitness: userCommentsCounterWitness,
    initialTargetsCommentsCounters: initialTargetsCommentsCounters,
    latestTargetsCommentsCounters: latestTargetsCommentsCounters,
    targetCommentsCounterWitness: targetCommentsCounterWitness,
    initialComments: initialComments,
    latestComments: latestComments,
    commentWitness: commentWitness,
    commentState: commentState,
  };
}

export function createCommentDeletionTransitionValidInputs(
  targetState: PostState,
  commenterKey: PrivateKey,
  allCommentsCounter: Field,
  initialCommentState: CommentState,
  deletionBlockHeight: Field,
  targetsMap: MerkleMap,
  usersCommentsCountersMap: MerkleMap,
  targetsCommentsCountersMap: MerkleMap,
  commentsMap: MerkleMap
) {
  const commentStateHash = initialCommentState.hash();
  const signature = Signature.create(commenterKey, [
    commentStateHash,
    fieldToFlagCommentsAsDeleted,
  ]);

  const targets = targetsMap.getRoot();
  const usersCommentsCounters = usersCommentsCountersMap.getRoot();
  const targetsCommentsCounters = targetsCommentsCountersMap.getRoot();

  const posterAddressAsField = Poseidon.hash(
    targetState.posterAddress.toFields()
  );
  const postContentIDHash = targetState.postContentID.hash();
  const targetKey = Poseidon.hash([posterAddressAsField, postContentIDHash]);

  const targetWitness = targetsMap.getWitness(targetKey);

  const commenterAddressAsField = Poseidon.hash(
    initialCommentState.commenterAddress.toFields()
  );

  const initialComments = commentsMap.getRoot();

  const commentKey = Poseidon.hash([
    targetKey,
    commenterAddressAsField,
    initialCommentState.commentContentID.hash(),
  ]);
  const commentWitness = commentsMap.getWitness(commentKey);

  const latestCommentState = new CommentState({
    isTargetPost: new Bool(true),
    targetKey,
    commenterAddress: initialCommentState.commenterAddress,
    commentContentID: initialCommentState.commentContentID,
    allCommentsCounter: initialCommentState.allCommentsCounter,
    userCommentsCounter: initialCommentState.userCommentsCounter,
    targetCommentsCounter: initialCommentState.targetCommentsCounter,
    commentBlockHeight: initialCommentState.commentBlockHeight,
    deletionBlockHeight: deletionBlockHeight,
    restorationBlockHeight: initialCommentState.restorationBlockHeight,
  });

  commentsMap.set(commentKey, latestCommentState.hash());
  const latestComments = commentsMap.getRoot();

  return {
    signature: signature,
    targets: targets,
    targetState: targetState,
    targetWitness: targetWitness,
    allCommentsCounter: allCommentsCounter,
    usersCommentsCounters: usersCommentsCounters,
    targetsCommentsCounters: targetsCommentsCounters,
    initialComments: initialComments,
    latestComments: latestComments,
    initialCommentState: initialCommentState,
    latestCommentState: latestCommentState,
    commentWitness: commentWitness,
  };
}

export function createCommentRestorationTransitionValidInputs(
  targetState: PostState,
  commenterKey: PrivateKey,
  allCommentsCounter: Field,
  initialCommentState: CommentState,
  restorationBlockHeight: Field,
  targetsMap: MerkleMap,
  usersCommentsCountersMap: MerkleMap,
  targetsCommentsCountersMap: MerkleMap,
  commentsMap: MerkleMap
) {
  const commentStateHash = initialCommentState.hash();
  const signature = Signature.create(commenterKey, [
    commentStateHash,
    fieldToFlagCommentsAsRestored,
  ]);

  const targets = targetsMap.getRoot();
  const usersCommentsCounters = usersCommentsCountersMap.getRoot();
  const targetsCommentsCounters = targetsCommentsCountersMap.getRoot();

  const posterAddressAsField = Poseidon.hash(
    targetState.posterAddress.toFields()
  );
  const postContentIDHash = targetState.postContentID.hash();
  const targetKey = Poseidon.hash([posterAddressAsField, postContentIDHash]);

  const targetWitness = targetsMap.getWitness(targetKey);

  const commenterAddressAsField = Poseidon.hash(
    initialCommentState.commenterAddress.toFields()
  );

  const initialComments = commentsMap.getRoot();

  const commentKey = Poseidon.hash([
    targetKey,
    commenterAddressAsField,
    initialCommentState.commentContentID.hash(),
  ]);
  const commentWitness = commentsMap.getWitness(commentKey);

  const latestCommentState = new CommentState({
    isTargetPost: new Bool(true),
    targetKey,
    commenterAddress: initialCommentState.commenterAddress,
    commentContentID: initialCommentState.commentContentID,
    allCommentsCounter: initialCommentState.allCommentsCounter,
    userCommentsCounter: initialCommentState.userCommentsCounter,
    targetCommentsCounter: initialCommentState.targetCommentsCounter,
    commentBlockHeight: initialCommentState.commentBlockHeight,
    deletionBlockHeight: Field(0),
    restorationBlockHeight: restorationBlockHeight,
  });

  commentsMap.set(commentKey, latestCommentState.hash());
  const latestComments = commentsMap.getRoot();

  return {
    signature: signature,
    targets: targets,
    targetState: targetState,
    targetWitness: targetWitness,
    allCommentsCounter: allCommentsCounter,
    usersCommentsCounters: usersCommentsCounters,
    targetsCommentsCounters: targetsCommentsCounters,
    initialComments: initialComments,
    latestComments: latestComments,
    initialCommentState: initialCommentState,
    latestCommentState: latestCommentState,
    commentWitness: commentWitness,
  };
}
