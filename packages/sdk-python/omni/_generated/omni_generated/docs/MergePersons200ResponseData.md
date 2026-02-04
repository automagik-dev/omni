# MergePersons200ResponseData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**person** | [**SearchPersons200ResponseItemsInner**](SearchPersons200ResponseItemsInner.md) |  | 
**merged_identity_ids** | **List[UUID]** |  | 
**deleted_person_id** | **UUID** |  | 

## Example

```python
from omni_generated.models.merge_persons200_response_data import MergePersons200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of MergePersons200ResponseData from a JSON string
merge_persons200_response_data_instance = MergePersons200ResponseData.from_json(json)
# print the JSON string representation of the object
print(MergePersons200ResponseData.to_json())

# convert the object into a dict
merge_persons200_response_data_dict = merge_persons200_response_data_instance.to_dict()
# create an instance of MergePersons200ResponseData from a dict
merge_persons200_response_data_from_dict = MergePersons200ResponseData.from_dict(merge_persons200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


