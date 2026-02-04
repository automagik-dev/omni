# ListAccessRules200ResponseItemsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Rule UUID | 
**instance_id** | **UUID** | Instance UUID (null for global) | 
**rule_type** | **str** | Rule type | 
**phone_pattern** | **str** | Phone pattern | 
**platform_user_id** | **str** | Platform user ID | 
**person_id** | **UUID** | Person UUID | 
**priority** | **int** | Priority (higher &#x3D; checked first) | 
**enabled** | **bool** | Whether enabled | 
**reason** | **str** | Reason | 
**expires_at** | **datetime** | Expiration | 
**action** | **str** | Action | 
**block_message** | **str** | Custom block message | 
**created_at** | **datetime** | Creation timestamp | 
**updated_at** | **datetime** | Last update timestamp | 

## Example

```python
from omni_generated.models.list_access_rules200_response_items_inner import ListAccessRules200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ListAccessRules200ResponseItemsInner from a JSON string
list_access_rules200_response_items_inner_instance = ListAccessRules200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(ListAccessRules200ResponseItemsInner.to_json())

# convert the object into a dict
list_access_rules200_response_items_inner_dict = list_access_rules200_response_items_inner_instance.to_dict()
# create an instance of ListAccessRules200ResponseItemsInner from a dict
list_access_rules200_response_items_inner_from_dict = ListAccessRules200ResponseItemsInner.from_dict(list_access_rules200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


