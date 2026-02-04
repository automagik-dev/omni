# MergePersonsRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**source_person_id** | **UUID** | Person to merge from (will be deleted) | 
**target_person_id** | **UUID** | Person to merge into (will be kept) | 
**reason** | **str** | Reason for merge | [optional] 

## Example

```python
from omni_generated.models.merge_persons_request import MergePersonsRequest

# TODO update the JSON string below
json = "{}"
# create an instance of MergePersonsRequest from a JSON string
merge_persons_request_instance = MergePersonsRequest.from_json(json)
# print the JSON string representation of the object
print(MergePersonsRequest.to_json())

# convert the object into a dict
merge_persons_request_dict = merge_persons_request_instance.to_dict()
# create an instance of MergePersonsRequest from a dict
merge_persons_request_from_dict = MergePersonsRequest.from_dict(merge_persons_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


