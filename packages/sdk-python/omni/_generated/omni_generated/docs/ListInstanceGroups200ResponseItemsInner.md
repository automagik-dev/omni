# ListInstanceGroups200ResponseItemsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**external_id** | **str** | External group ID | 
**name** | **str** | Group name | [optional] 
**description** | **str** | Group description | [optional] 
**member_count** | **float** | Number of members | [optional] 
**created_at** | **datetime** | Creation timestamp | [optional] 
**created_by** | **str** | Creator ID | [optional] 
**is_read_only** | **bool** | Whether group is read-only | [optional] 
**platform_metadata** | **Dict[str, Optional[object]]** | Platform-specific metadata | [optional] 

## Example

```python
from omni_generated.models.list_instance_groups200_response_items_inner import ListInstanceGroups200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ListInstanceGroups200ResponseItemsInner from a JSON string
list_instance_groups200_response_items_inner_instance = ListInstanceGroups200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(ListInstanceGroups200ResponseItemsInner.to_json())

# convert the object into a dict
list_instance_groups200_response_items_inner_dict = list_instance_groups200_response_items_inner_instance.to_dict()
# create an instance of ListInstanceGroups200ResponseItemsInner from a dict
list_instance_groups200_response_items_inner_from_dict = ListInstanceGroups200ResponseItemsInner.from_dict(list_instance_groups200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


