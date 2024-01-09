import {
  Field,
  PrivateKey,
  PublicKey,
  MerkleMap,
  Poseidon,
  Signature,
  Bool,
  CircuitString,
} from 'o1js';
import { PostState } from '../posts/Posts';
import { CommentState } from './Comments.js';

export function createCommentTransitionValidInputs(
  targetState: PostState,
  commenterAddress: PublicKey,
  commenterKey: PrivateKey,
  commentContentID: CircuitString,
  allCommentsCounter: Field,
  userCommentsCounter: Field,
  targetCommentsCounter: Field,
  commentBlockHeight: Field,
  postsMap: MerkleMap,
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

  const targetWitness = postsMap.getWitness(
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
