# CreateAccessRuleRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance ID (null for global) | [optional] 
**rule_type** | **str** | Rule type | 
**phone_pattern** | **str** | Phone pattern with wildcards | [optional] 
**platform_user_id** | **str** | Exact platform user ID | [optional] 
**person_id** | **UUID** | Person ID | [optional] 
**priority** | **int** | Priority | [optional] [default to 0]
**enabled** | **bool** | Whether enabled | [optional] [default to True]
**reason** | **str** | Reason | [optional] 
**expires_at** | **datetime** | Expiration | [optional] 
**action** | **str** | Action | [optional] [default to 'block']
**block_message** | **str** | Custom block message | [optional] 

## Example

```python
from omni_generated.models.create_access_rule_request import CreateAccessRuleRequest

# TODO update the JSON string below
json = "{}"
# create an instance of CreateAccessRuleRequest from a JSON string
create_access_rule_request_instance = CreateAccessRuleRequest.from_json(json)
# print the JSON string representation of the object
print(CreateAccessRuleRequest.to_json())

# convert the object into a dict
create_access_rule_request_dict = create_access_rule_request_instance.to_dict()
# create an instance of CreateAccessRuleRequest from a dict
create_access_rule_request_from_dict = CreateAccessRuleRequest.from_dict(create_access_rule_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


