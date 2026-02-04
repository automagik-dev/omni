# CheckAccess200ResponseDataRule

Matching rule if any

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
from omni_generated.models.check_access200_response_data_rule import CheckAccess200ResponseDataRule

# TODO update the JSON string below
json = "{}"
# create an instance of CheckAccess200ResponseDataRule from a JSON string
check_access200_response_data_rule_instance = CheckAccess200ResponseDataRule.from_json(json)
# print the JSON string representation of the object
print(CheckAccess200ResponseDataRule.to_json())

# convert the object into a dict
check_access200_response_data_rule_dict = check_access200_response_data_rule_instance.to_dict()
# create an instance of CheckAccess200ResponseDataRule from a dict
check_access200_response_data_rule_from_dict = CheckAccess200ResponseDataRule.from_dict(check_access200_response_data_rule_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


